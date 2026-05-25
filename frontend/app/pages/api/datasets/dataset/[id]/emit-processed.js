/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: emit-processed.js
 * Copyright (c) 2024
 */

import { createApiClient } from '../../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);
  const { id } = req.query;

  if (req.method === 'POST') {
    try {
      const response = await api.post(`api/datasets/dataset/${id}/emit-processed/`, req.body);
      res.status(202).json(response.data);
    } catch (error) {
      console.error('Failed to queue emit_processed:', error);
      const status = error?.response?.status || 500;
      const message = error?.response?.data?.error || error?.response?.data?.detail || 'Failed to queue emit_processed';
      res.status(status).json({ message });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
