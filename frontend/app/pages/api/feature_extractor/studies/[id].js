/*
 * Shark AI — studies/[id] proxy
 */

import { createApiClient } from '../../../../utils/apiProxy';

export default async function handler(req, res) {
  const { id } = req.query;
  const api = createApiClient(req);

  if (req.method === 'GET') {
    try {
      const response = await api.get(`api/feature_extractor/studies/${id}/`);
      res.status(200).json(response.data);
    } catch (error) {
      res.status(error.response?.status || 500).json(error.response?.data || { message: 'Failed to fetch study' });
    }
  } else if (req.method === 'PATCH') {
    try {
      const response = await api.patch(`api/feature_extractor/studies/${id}/`, req.body);
      res.status(200).json(response.data);
    } catch (error) {
      res.status(error.response?.status || 500).json(error.response?.data || { message: 'Failed to update study' });
    }
  } else if (req.method === 'DELETE') {
    try {
      await api.delete(`api/feature_extractor/studies/${id}/`);
      res.status(204).end();
    } catch (error) {
      res.status(error.response?.status || 500).json(error.response?.data || { message: 'Failed to delete study' });
    }
  } else {
    res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
