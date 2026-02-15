/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: index.js
 * Copyright (c) 2024
 */

import { createApiClient } from '../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);
  const { training_session } = req.query;

  if (req.method === 'GET') {
    try {
      // Use the environment variable to get the base URL
      const response = await api.get(`api/feature_extractor/epoch/`, {
        params: {
          training_session,
        }
      });
      const data = response.data;

      res.status(200).json(data);
    } catch (error) {
      console.error('Failed to fetch training sessions:', error);
      res.status(500).json({ message: 'Failed to fetch training sessions' });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
