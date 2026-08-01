/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: review-queue.js
 * Copyright (c) 2024
 */

import { createApiClient } from '../../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);
  const { id, counts_only: countsOnly } = req.query;
  if (req.method === 'GET') {
    try {
      // Pass through counts_only so callers that need only the totals can
      // skip serialising every flagged image.
      const qs = countsOnly ? '?counts_only=1' : '';
      const response = await api.get(`api/datasets/dataset/${id}/review-queue/${qs}`);
      res.status(200).json(response.data);
    } catch (error) {
      const status = error?.response?.status || 500;
      res.status(status).json({ message: error?.response?.data?.error || 'Failed to load review queue' });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
