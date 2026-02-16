/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: [id].js
 * Copyright (c) 2024
 */

import { createApiClient } from '../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);
  const { id } = req.query;
  const url = `api/datasets/image/${id}/`;

  try {
    switch (req.method) {
      case 'GET': {
        const response = await api.get(url);
        return res.status(200).json(response.data);
      }
      case 'PATCH': {
        const response = await api.patch(url, req.body);
        return res.status(200).json(response.data);
      }
      case 'DELETE': {
        await api.delete(url);
        return res.status(204).end();
      }
      default:
        res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error('Image API error:', error);
    const status = error?.response?.status || 500;
    const message = error?.response?.data?.error || 'Image API request failed';
    return res.status(status).json({ message });
  }
}
