/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: site-settings/index.js
 * Copyright (c) 2024
 */

import { createApiClient } from '../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);

  if (req.method === 'GET') {
    try {
      const response = await api.get('api/feature_extractor/site-settings/');
      res.status(200).json(response.data);
    } catch (error) {
      console.error('Failed to fetch site settings:', error);
      res.status(500).json({ message: 'Failed to fetch site settings' });
    }
  } else if (req.method === 'PATCH') {
    try {
      const response = await api.patch('api/feature_extractor/site-settings/update_settings/', req.body);
      res.status(200).json(response.data);
    } catch (error) {
      console.error('Failed to update site settings:', error);
      const status = error.response?.status || 500;
      res.status(status).json({ message: 'Failed to update site settings' });
    }
  } else {
    res.setHeader('Allow', ['GET', 'PATCH']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
