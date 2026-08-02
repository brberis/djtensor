/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: reset-scale.js
 * Copyright (c) 2024
 */

import { createApiClient } from '../../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);
  const { id } = req.query;
  if (req.method === 'POST') {
    try {
      const response = await api.post(`api/datasets/image/${id}/reset-scale/`, {});
      res.status(200).json(response.data);
    } catch (error) {
      const status = error?.response?.status || 500;
      res.status(status).json({
        message: error?.response?.data?.error || 'Failed to undo the manual scale',
      });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
