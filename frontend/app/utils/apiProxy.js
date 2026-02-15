/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: apiProxy.js
 * Copyright (c) 2024
 */

import axios from 'axios';

// Extracts a named cookie value from a cookie header string.
function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

// Creates an axios instance that forwards session cookies from the incoming
// request to the Django backend. This keeps the user authenticated across
// the Next.js API proxy layer.
export function createApiClient(req) {
  let baseURL = process.env.DJANGO_API_BASE_URL || '';
  // Ensure trailing slash so relative paths resolve correctly
  if (baseURL && !baseURL.endsWith('/')) {
    baseURL += '/';
  }
  const headers = {};

  // Forward all cookies so the Django session is preserved
  if (req.headers.cookie) {
    headers['Cookie'] = req.headers.cookie;

    // Extract CSRF token from the cookie and set it as a header.
    // Django expects the token in the X-CSRFToken header for session-authenticated
    // requests that modify data (POST, PUT, DELETE, PATCH).
    const csrfToken = getCookieValue(req.headers.cookie, 'csrftoken');
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken;
    }
  }

  // Forward the Referer header so Django CSRF validation passes for HTTPS requests.
  if (req.headers.referer) {
    headers['Referer'] = req.headers.referer;
  } else if (req.headers.origin) {
    headers['Referer'] = req.headers.origin;
  } else {
    // Fallback: use the public origin from the environment so CSRF checks pass
    const origin = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.DJANGO_API_BASE_URL || '';
    if (origin) {
      headers['Referer'] = origin;
    }
  }

  return axios.create({
    baseURL,
    headers,
  });
}
