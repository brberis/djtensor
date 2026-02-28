import axios from "axios";

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const re = new RegExp("(?:^|;\\s*)" + name + "=([^;]*)");
  const match = cookieHeader.match(re);
  return match ? decodeURIComponent(match[1]) : null;
}

function createAuthClient(req) {
  // Auth endpoints live at /auth/api/ not /data/api/
  let baseURL = process.env.DJANGO_BASE_URL || "";
  if (baseURL && !baseURL.endsWith("/")) baseURL += "/";
  const headers = {};
  if (req.headers.cookie) {
    headers["Cookie"] = req.headers.cookie;
    const csrfToken = getCookieValue(req.headers.cookie, "csrftoken");
    if (csrfToken) headers["X-CSRFToken"] = csrfToken;
  }
  if (req.headers.referer) headers["Referer"] = req.headers.referer;
  else if (req.headers.origin) headers["Referer"] = req.headers.origin;
  return axios.create({ baseURL, headers });
}

export default async function handler(req, res) {
  const api = createAuthClient(req);

  try {
    if (req.method === "GET") {
      const response = await api.get("auth/api/users/");
      return res.status(200).json(response.data);
    }

    if (req.method === "POST") {
      const response = await api.post("auth/api/users/create/", req.body);
      return res.status(201).json(response.data);
    }

    return res.status(405).end("Method " + req.method + " Not Allowed");
  } catch (error) {
    return res.status(error?.response?.status || 500).json({
      message: error?.response?.data?.error || "Request failed",
    });
  }
}
