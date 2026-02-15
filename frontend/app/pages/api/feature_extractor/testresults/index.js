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
  const { id } = req.query;
  const url = `api/feature_extractor/testresult/`;

  switch (req.method) {
    case 'GET':
      try {
        const { test__id } = req.query;
        const response = await api.get(url, { params: { test__id } } );
        const data = response.data;
        res.status(200).json(data);
      } catch (error) {
        console.error('Failed to fetch training test result:', error);
        res.status(500).json({ message: 'Failed to fetch test result' });
      }
      break;


    case 'DELETE':
      try {
        const { id } = req.query;  
        if (!id) {
          return res.status(400).json({ message: 'Missing ID for deletion' });
        }
        await api.get(url);
        res.status(204).end();  
      } catch (error) {
        console.error('Failed to delete training test esult:', error);
        res.status(500).json({ message: 'Failed to delete test result' });
      }
      break;

    default:
      res.setHeader('Allow', ['GET', 'DELETE']);
      res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
