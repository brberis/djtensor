/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: scale-summary.js
 * Copyright (c) 2024
 */

import { createApiClient } from '../../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);
  const { id } = req.query;
  if (req.method === 'GET') {
    try {
      const response = await api.get(`api/datasets/dataset/${id}/scale-summary/`);
      res.status(200).json(response.data);
    } catch (error) {
      const status = error?.response?.status || 500;
      res.status(status).json({ message: error?.response?.data?.error || 'Failed to load scale summary' });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
