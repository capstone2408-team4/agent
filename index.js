import * as rrweb from 'rrweb';

class ProvidenceAgent {
  constructor(options) {
    this.options = options;
    this.stopFn = null;
    this.events = [];
    this.saveInterval = null;
    // this.projectUuid
  }

  startRecord() {
    if (this.stopFn) {
      console.warn('Recording is already in progress. Call stopRecord() before starting a new recording.');
      return;
    }

    this.stopFn = rrweb.record({
      emit: (event) => {
        this.events.push(event);

        // If a callback was provided for this config property, execute it
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

    const body = JSON.stringify({ events: this.events });
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