/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: retest.js
 * Copyright (c) 2024
 */

import { createApiClient } from ../../../../../utils/apiProxy;

export default async function handler(req, res) {
  const api = createApiClient(req);
  const { id } = req.query;
  const url = `api/feature_extractor/tests/${id}/retest/`;

  if (req.method !== POST) {
    res.setHeader(Allow, [POST]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const response = await api.post(url, {});
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error(Failed to re-test:, error);
    return res.status(500).json({ message: Failed to re-test });
  }
}
