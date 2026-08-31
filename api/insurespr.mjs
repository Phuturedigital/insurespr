import { createBridgeHandler } from '../lib/verification-bridge.mjs';

const handleBridgeRequest = createBridgeHandler();

// Vercel's Web Handler keeps the exact request URL, body and platform-provided
// client-IP headers intact while returning a standard Response object.
export default {
  fetch(request) {
    return handleBridgeRequest(request);
  },
};
