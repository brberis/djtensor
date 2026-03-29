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
  const url = `api/datasets/dataset/${id}/`;

  switch (req.method) {
    case 'GET':
      try {
        const response = await api.get(url);
        res.status(200).json(response.data);
      } catch (error) {
        console.error('Failed to fetch dataset:', error);
        res.status(500).json({ message: 'Failed to fetch dataset' });
      }
      break;

    case 'DELETE':
      try {
        if (!id) {
          return res.status(400).json({ message: 'Missing ID for deletion' });
        }
        await api.delete(url);
        res.status(204).end();
      } catch (error) {
        console.error('Failed to delete dataset:', error);
        const status = error?.response?.status || 500;
        const message = error?.response?.data?.error || 'Failed to delete dataset';
        res.status(status).json({ message });
      }
      break;

    default:
      res.setHeader('Allow', ['GET', 'DELETE']);
      res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
