/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: bulk-delete.js
 * Copyright (c) 2024
 */

import { createApiClient } from '../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const response = await api.post('api/datasets/image/bulk_delete/', req.body || {});
    return res.status(200).json(response.data);
  } catch (error) {
    console.error('Bulk delete failed:', error);
    const status = error?.response?.status || 500;
    const message = error?.response?.data?.error || 'Bulk delete failed';
    return res.status(status).json({ message });
  }
}
