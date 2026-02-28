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

import { createApiClient } from '../../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);
  const { id } = req.query;
  const url = `api/feature_extractor/tests/${id}`;

  switch (req.method) {
    case 'GET':
      try {
        const response = await api.get(url);
        const data = response.data;
        res.status(200).json(data);
      } catch (error) {
        console.error('Failed to fetch training test:', error);
        res.status(500).json({ message: 'Failed to fetch test' });
      }
      break;


    case 'DELETE':
      try {
        const { id } = req.query;  
        if (!id) {
          return res.status(400).json({ message: 'Missing ID for deletion' });
        }
        await api.delete(url);
        res.status(204).end();  
      } catch (error) {
        console.error('Failed to delete training test esult:', error);
        res.status(500).json({ message: 'Failed to delete test result' });
      }
      break;

    case 'PATCH':
      try {
        const response = await api.patch(url + '/', req.body);
        res.status(200).json(response.data);
      } catch (error) {
        console.error('Failed to update test:', error);
        res.status(error?.response?.status || 500).json({ message: 'Failed to update test' });
      }
      break;

    default:
      res.setHeader('Allow', ['GET', 'DELETE', 'PATCH']);
      res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
