import * as rrweb from 'rrweb';
import { v4 as uuid } from 'uuid';

class ProvidenceAgent {
  constructor(options) {
    if (!options.backendUrl || !options.projectId) {
      throw new Error('backendUrl and projectId are required');
    }

    this.options = options;
    this.stopFn = null;
    this.events = [];
    this.saveInterval = null;
    this.projectId = options.projectId;
    this.sessionId = uuid();
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
  }

  sendBatch() {
    if (this.events.length === 0) return;

    const body = JSON.stringify({
      projectId: this.projectId,
      sessionId: this.sessionId,
      events: this.events
    });
    this.events = [];

    fetch(this.options.backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    })
    .then(response => console.log(response))
    .catch(error => console.error('Error sending events batch:', error));
  }
}

export default ProvidenceAgent;