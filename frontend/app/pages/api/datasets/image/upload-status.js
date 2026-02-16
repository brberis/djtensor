/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: upload-status.js
 * Copyright (c) 2024
 *
 * Next.js API proxy for checking archive upload task status.
 */

import { createApiClient } from '../../../../utils/apiProxy';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { task_id } = req.query;
  if (!task_id) {
    return res.status(400).json({ error: 'task_id query parameter is required' });
  }

  const api = createApiClient(req);

  try {
    const response = await api.get(`api/datasets/image/upload-status/${task_id}/`);
    res.status(200).json(response.data);
  } catch (error) {
    console.error('Upload status proxy error:', error?.response?.data || error.message);
    const status = error?.response?.status || 500;
    const data = error?.response?.data || { error: error.message };
    res.status(status).json(data);
  }
}
