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
  }

  startRecord() {
    if (this.stopFn) {
      console.warn('Recording is already in progress. Call stopRecord() before starting a new recording.');
      return;
    }

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

    // Send any remaining events
    this.sendBatch();

    console.log(`Stopped recording for session ${this.sessionID}`);
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

    fetch(this.options.backendUrl, {
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
    })
  }
}

export default ProvidenceAgent;