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
    this.boundVisibilityHandler = null;

    // Store original implementations before we override them
    // globalThis.fetch is an alias for window.fetch (gpt says it is 'best practice')
    this.originalFetch = window.fetch.bind(window);
    this.originalXHROpen = XMLHttpRequest.prototype.open;
    this.originalWebSocket = window.WebSocket;

    // Visibility config
    if (this.visibilityTimeout) {
      clearTimeout(this.visibilityTimeout);
    }
    this.visibilityTimeout = null;
    this.VISIBILITY_TIMEOUT_MS = 15000; // 15 seconds in milliseconds

    // Cleanup any existing intervals
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }

    // Full cleanup on page unload
    window.addEventListener('unload', () => {
      console.log('[Agent] Unloading page - stopping recording');
      if (this.boundVisibilityHandler) {
        document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
        this.boundVisibilityHandler = null;
      }
      this.stopRecord();
    });
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

    // Handle visibility changes with stored bound handler
    this.boundVisibilityHandler = this.handleVisibilityChange.bind(this);
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);

    console.log(`Started recording for session ${this.sessionID}`);
  }

  stopRecord() {
    if (this.visibilityTimeout) {
      clearTimeout(this.visibilityTimeout);
      this.visibilityTimeout = null;
    }

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

    // Remove visibility change listener using stored bound handler
    if (this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }

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
    console.log('[Agent] Setting up fetch interceptor');
    window.fetch = async (...args) => {
      try {
        let [resource, config] = args;

        // Don't capture our own recording requests
        if (resource === this.options.backendUrl) {
          return this.originalFetch(resource, config);
        }
  
        console.log('[Agent] Fetch intercepted:', {
          url: resource instanceof Request ? resource.url : resource,
          method: config?.method || 'GET'
        });
  
        // communicate to AI that 'type 50 is a network request'
        const networkEventObj = { type: 50, data: {} };
        this.handleFetchRequest(resource, config, networkEventObj);
  
        const response = await this.originalFetch(resource, config);
        this.handleFetchResponse(response, networkEventObj);
  
        console.log('[Agent] Fetch completed:', {
          url: networkEventObj.data.url,
          status: networkEventObj.data.status,
          latency: networkEventObj.data.latency
        });
  
        this.events.push(networkEventObj);
        return response;
      } catch (error) {
        console.error('[Agent] Error in fetch interceptor:', error);
        // Log error event
        this.events.push({
          type: 50,
          timestamp: Date.now(),
          data: {
            type: 'FETCH',
            error: error.message,
            url: args[0]?.toString() || 'unknown'
          }
        });
        throw error;
      }
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

    if (!response.ok) {
      networkEventObj.data.error = `HTTP Error ${response.status}`;
    }
  }

  interceptXHR() {
    console.log('[Agent] Setting up XHR interceptor');
    const self = this;
    const originalOpen = this.originalXHROpen;

    XMLHttpRequest.prototype.open = function(...args) {
      const [method, url] = args;
      console.log('[Agent] XHR intercepted:', { method, url });

      const networkEventObj = { type: 50, data: {} };
      const urlString = typeof url === 'string' ? url : url?.toString() || '';
      networkEventObj.data = {
        url: urlString,
        type: 'XHR',
        method: method,
        requestMadeAt: Date.now(),
      }

      this.addEventListener('load', function() {
        const currentTime = Date.now();
        networkEventObj.timestamp = currentTime;
        networkEventObj.data.responseReceivedAt = currentTime;
        networkEventObj.data.latency = currentTime - networkEventObj.data.requestMadeAt;
        networkEventObj.data.status = this.status;

        console.log('[Agent] XHR completed:', {
          url: networkEventObj.data.url,
          status: networkEventObj.data.status,
          latency: networkEventObj.data.latency
        });

        self.events.push(networkEventObj);
      });

      this.addEventListener('error', function() {
        console.log('[Agent] XHR error:', { 
          url: networkEventObj.data.url,
          method: networkEventObj.data.method 
        });
        networkEventObj.data.error = 'Network Error';
        self.events.push(networkEventObj);
      });

      this.addEventListener('timeout', function() {
        console.log('[Agent] XHR timeout:', {
          url: networkEventObj.data.url,
          method: networkEventObj.data.method
        });
        networkEventObj.data.error = 'Timeout';
        self.events.push(networkEventObj);
      });

      return originalOpen.apply(this, args);
    }
  }

  interceptWebSocket() {
    console.log('[Agent] Setting up WebSocket interceptor');
    const self = this;
    const OriginalWebSocket = this.originalWebSocket;

    window.WebSocket = function(url, protocols) {
      console.log('[Agent] WebSocket connection initiated:', { url, protocols });

      const ws = new OriginalWebSocket(url, protocols);
      const urlString = url.toString();

      ws.addEventListener('open', () => {
        console.log('[Agent] WebSocket opened:', { url: urlString });
        self.events.push({
          type: 50,
          timestamp: Date.now(),
          data: {
            url: urlString,
            type: 'WebSocket',
            event: 'open',
          },
        });
      });

      ws.addEventListener('message', (event) => {
        console.log('[Agent] WebSocket message received:', { 
          url: urlString, 
          dataType: typeof event.data,
          dataPreview: typeof event.data === 'string' ? 
            event.data.slice(0, 100) : 'Binary data'
        });

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

      ws.addEventListener('close', (event) => {
        console.log('[Agent] WebSocket closed:', { 
          url: urlString,
          code: event.code,
          reason: event.reason
        });
        self.events.push({
          type: 50,
          timestamp: Date.now(),
          data: {
            url: urlString,
            type: 'WebSocket',
            event: 'close',
            code: event.code,
            reason: event.reason
          },
        });
      });

      ws.addEventListener('error', (error) => {
        console.log('[Agent] WebSocket error:', { 
          url: urlString,
          error: error.message || 'Unknown error'
        });

        self.events.push({
          type: 50,
          timestamp: Date.now(),
          data: {
            url: urlString,
            type: 'WebSocket',
            event: 'error',
            error: error.message || 'Unknown error'
          },
        });
      });

      const originalSend = ws.send.bind(ws);
      ws.send = function(data) {
        console.log('[Agent] WebSocket message sent:', {
          url: urlString,
          dataType: typeof data,
          dataPreview: typeof data === 'string' ? 
            data.slice(0, 100) : 'Binary data'
        });

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
    XMLHttpRequest.prototype.open = this.originalXHROpen;
    window.WebSocket = this.originalWebSocket;
  }

  handleVisibilityChange() {
    try {
      if (document.visibilityState === 'hidden') { // User has switched tabs or minimized window
        // Pause recording but keep interceptors alive
        if (this.stopFn) {
          this.stopFn();
          this.stopFn = null;
        }
  
        if (this.saveInterval) {
          clearInterval(this.saveInterval);
          this.saveInterval = null;
        }
  
        // Send any pending events
        this.sendBatch();
  
        // Set up 15 second timer for full teardown minus visibility change listener
        this.visibilityTimeout = setTimeout(() => {
          console.log('[Agent] Visibility timeout reached - performing interceptor reset');
          this.visibilityTimeout = null;
  
          // Restore original network implementations
          this.restoreNetworkImplementations();
  
        }, this.VISIBILITY_TIMEOUT_MS);
  
      } else if (document.visibilityState === 'visible') { // User has returned to the tab
        // Clear timeout if it exists
        if (this.visibilityTimeout) { // User returned before the timeout
          console.log('[Agent] Visibility restored before timeout - continuing recording');
          clearTimeout(this.visibilityTimeout);
          this.visibilityTimeout = null;
  
          // Restart rrweb recording and save interval
          this.stopFn = rrweb.record({
            emit: (event) => {
              this.events.push(event);
              if (typeof this.options.onEventRecorded === 'function') {
                this.options.onEventRecorded(event);
              }
            },
          });
  
          this.saveInterval = setInterval(() => this.sendBatch(), 5000);
        } else { // User returned after the timeout has passed
          console.log('[Agent] Visibility restored after timeout - starting new session');
          this.sessionID = uuid();
          this.startRecord();
        }
      }
    } catch (error) {
      console.error('[Agent] Error handling visibility change:', error);
      // Attempt to restore to a known good state
      this.stopRecord();
      this.startRecord();
    }
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