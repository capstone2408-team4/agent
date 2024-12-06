# Providence Agent

This package provides session replay capabilities for the Providence framework using [rrweb](https://github.com/rrweb-io/rrweb). It captures detailed user interactions including DOM mutations, mouse movements, scrolling, network requests, and console output while respecting user privacy through automatic input masking.

## Prerequisites

Before installing the agent:

1. Ensure you've gone through the infrastructure [installation guide](https://github.com/providence-replay/providence/blob/main/README.md) (using either the local option or the AWS option)
2. Note the URL to your Providence API (or ALB if using the AWS option)
3. Log in to the dashboard to obtain your project ID

## Installation

```bash
npm install github:providence-replay/agent
```

## Quick Start

```javascript
import ProvidenceAgent from 'agent';

const agent = new ProvidenceAgent({
  backendUrl: 'https://your-api-or-alb-url',
  projectID: 'your-project-id' // From Providence dashboard
});

// Start recording
agent.startRecord();

// Stop recording (if needed)
agent.stopRecord();
```

## Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| backendUrl | string | Yes | Providence API URL. Use ALB URL if deployed via our tailored AWS CloudFormation template |
| projectID | string | Yes | Project ID from Providence dashboard |
| onEventRecorded | function | No | Optional callback to execute when events are recorded |

## What Gets Recorded

- DOM snapshots and mutations
- Mouse/touch movements and interactions
- Scroll positions
- Network requests (fetch/XHR/WebSocket)
- Console output
- Viewport resizing
- Input/form interactions (masked by default)
- Media playback
- Error states

## Privacy & Security

- All form inputs are masked by default
- No passwords or sensitive data captured
- Network request/response bodies excluded
- Client IPs resolved to general geo regions
- Data retention controlled by your deployment

## Advanced Usage

You can customize the recording behavior by configuring rrweb options in the agent source code where `rrweb.record` is called:

```javascript
// In startRecord():
this.stopFn = rrweb.record({
  emit: (event) => {
    // ...
  },
  maskAllInputs: true,
  // Configure desired rrweb options here
  plugins: [getRecordConsolePlugin()],
});

// In handleVisibilityChange():
this.stopFn = rrweb.record({
  emit: (event) => {
    // ...
  },
  maskAllInputs: true,
  // Configure desired rrweb options here
  plugins: [getRecordConsolePlugin()],
});
```

See [rrweb documentation](https://github.com/rrweb-io/rrweb/blob/master/guide.md#options) for all available customization options.

## Session Management

The agent automatically:
- Generates unique session IDs
- Handles page visibility changes
- Detects user inactivity (5 minute timeout)
- Batches events (5 second intervals)
- Restarts on user activity

## Network Capture

Network activity is recorded by intercepting:
- Fetch requests
- XMLHttpRequest (XHR)
- WebSocket connections

Only metadata (URL, method, status code, timing) is captured.
Request/response bodies are excluded for privacy.

## Browser Support

Supports all modern browsers:
- Chrome/Edge (Chromium)
- Firefox
- Safari
- Mobile browsers

## Local Development 

Point `backendUrl` to your local Providence deployment:
```javascript
const agent = new ProvidenceAgent({
  backendUrl: 'http://localhost:5001',
  projectID: 'your-project-id'
});
```
