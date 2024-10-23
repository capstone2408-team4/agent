import * as rrweb from 'rrweb';
import { v4 as uuid } from 'uuid';

class ProvidenceAgent {
  constructor(options) {
    if (!options.backendUrl || !options.projectID) {
      throw new Error('backendUrl and projectID are required');
    }

    this.options = options;
    this.stopFn = null;
    this.events = [];
    this.saveInterval = null;
    this.projectID = options.projectID;
    this.sessionID = uuid();

    // Store original implementations before we override them
    // globalThis.fetch is an alias for window.fetch (gpt says it is 'best practice')
    this.originalFetch = window.fetch;
    this.originalXHROpen = XMLHttpRequest.prototype.open;
    this.originalWebSocket = window.WebSocket;
  }

  startRecord() {
    if (this.stopFn) {
      console.warn('Recording is already in progress. Call stopRecord() before starting a new recording.');
      return;
    }

    // Initialize network capture
    this.initializeNetworkCapture();

    // Start rrweb recording
    this.stopFn = rrweb.record({
      emit: (event) => {
        this.events.push(event);

        // Optional callback to execute for each event recorded
        if (typeof this.options.onEventRecorded === 'function') {
          this.options.onEventRecorded(event);
        }
      },
    });

    // Save events every 5 seconds
    this.saveInterval = setInterval(() => this.sendBatch(), 5000);

    // Handle visiblity changes
    document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));

    console.log(`Started recording for session ${this.sessionID}`);
  }

  stopRecord() {
    if (this.stopFn) {
      this.stopFn();
      this.stopFn = null;
    }

    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    // Restore original network implementations
    this.restoreNetworkImplementations();

    // Remove visibility chcange listener
    document.removeEventListener('visibilitychange', this.handleVisibilityChange.bind(this));

    // Send any remaining events
    this.sendBatch();

    console.log(`Stopped recording for session ${this.sessionID}`);
  }

  initializeNetworkCapture() {
    this.interceptFetch();
    this.interceptXHR();
    this.interceptWebSocket();
  }

  interceptFetch() {
    window.fetch = async (...args) => {
      let [resource, config] = args;

      // Don't capture our own recording requests
      if (resource === this.options.backendUrl) {
        return this.originalFetch(resource, config);
      }

      // communicate to AI that 'type 50 is a network request'
      const networkEventObj = { type: 50, data: {} };
      this.handleFetchRequest(resource, config, networkEventObj);

      const response = await this.originalFetch(resource, config);
      this.handleFetchRequest(response, networkEventObj);

      this.events.push(networkEventObj);
      return response;

    }
  }

  handleFetchRequest(resource, config, networkEventObj) {
    if (resource instanceof Request) {
      networkEventObj.data = {
        url: resource.url,
        type: 'FETCH',
        requestMadeAt: Date.now(),
        method: resource.method,
      };
    } else {
      // better understand this
      networkEventObj.data = {
        url: resource.toString(),
        type: 'FETCH',
        requestMadeAt: Date.now(),
        method: config?.method || 'GET',
      };
    }
  }

  handleFetchResponse(response, networkEventObj) {
    const currentTime = Date.now();
    networkEventObj.timestamp = currentTime;
    networkEventObj.data.responseReceivedAt = currentTime;
    networkEventObj.data.latency = currentTime - networkEventObj.data.requestMadeAt;
    networkEventObj.data.status = response.status;
  }

  interceptXHR() {
    const self = this;

    XMLHttpRequest.prototype.open = (...args) => {
      const [method, url] = args;
      const xhrInstance = this; // this is the xhr instance
      const networkEventObj = { type: 50, data: {} };

      const urlString = typeof url === 'string' ? url : url?.toString() || '';
      networkEventObj.data = {
        url: urlString,
        type: 'XHR',
        method: method,
        requestMadeAt: Date.now(),
      }

      xhrInstance.addEventListener('load', function() {
        const currentTime = Date.now();
        networkEventObj.timestamp = currentTime;
        networkEventObj.data.responseReceivedAt = currentTime;
        networkEventObj.data.latency = currentTime - networkEventObj.data.requestMadeAt;
        networkEventObj.data.status = this.status;
        self.events.push(networkEventObj);
        console.log('XHR Request Captured:', networkEventObj);
      });

      return self.originalXHROpen.apply(xhrInstance, args);
    }
  }

  interceptWebSocket() {
    const self = this;
    window.WebSocket = function(url, protocols) {
      const ws = new self.originalWebSocket(url, protocols);
      const urlString = url.toString();

      ws.addEventListener('open', () => {
        self.events.push({
          type: 50,
          timestamp: Date.now(),
          data: {
            urlString,
            type: 'WebSocket',
            event: 'open',
          },
        });
      });

      ws.addEventListener('message', (event) => {
        self.events.push({
          type: 50,
          timestamp: Date.now(),
          data: {
            url: urlString,
            type: 'WebSocket',
            event: 'message',
            message: event.data,
          },
        });
      });

      ws.addEventListener('close', () => {
        self.events.push({
          type: 50,
          timestamp: Date.now(),
          data: {
            url: urlString,
            type: 'WebSocket',
            event: 'close',
          },
        });
      });

      const originalSend = ws.send;
      ws.send = function(data) {
        self.events.push({
          type: 50,
          timestamp: Date.now(),
          data: {
            url: urlString,
            type: 'WebSocket',
            event: 'send',
            message: data,
          },
        });
        originalSend.call(this, data);
      };

      return ws;
    };
  }

  restoreNetworkImplementations() {
    window.fetch = this.originalFetch;
    XMLHttpRequest.prototype.open = this.originalWebSocket;
    window.WebSocket = this.originalWebSocket;
  }

  handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      // User has switched tabs or minimized window
      this.stopRecord();
    } else if (document.visibilityState === 'visible') {
      // User has returned to the tab
      this.startRecord();
    }
    // Send any pending events
    this.sendBatch();
  }

  sendBatch() {
    if (this.events.length === 0) return;

    const eventsToSend = [...this.events];
    this.events = [];

    const body = JSON.stringify({
      projectID: this.projectID,
      sessionID: this.sessionID,
      events: eventsToSend
    });

    this.originalFetch(this.options.backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      console.log(`Sent ${eventsToSend.length} events for session ${this.sessionID}`);
    })
    .catch(error => {
      console.error('Error sending events batch:', error);
      // Add the events back to the queue for next try
      this.events = [...eventsToSend, ...this.events];
    });
  }
}

export default ProvidenceAgent;