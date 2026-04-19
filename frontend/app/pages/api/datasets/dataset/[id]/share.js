/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: share.js
 * Copyright (c) 2024
 */

import { createApiClient } from '../../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);
  const { id } = req.query;
  const url = `api/datasets/dataset/${id}/share/`;

  try {
    if (req.method === 'GET') {
      const response = await api.get(url);
      return res.status(200).json(response.data);
    }
    if (req.method === 'POST') {
      const response = await api.post(url, req.body);
      return res.status(200).json(response.data);
    }
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error) {
    const status = error?.response?.status || 500;
    const data = error?.response?.data || { message: 'Failed to update sharing' };
    return res.status(status).json(data);
  }
}
