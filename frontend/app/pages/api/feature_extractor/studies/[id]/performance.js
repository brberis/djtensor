import { createApiClient } from '../../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);
  const { id } = req.query;

  if (req.method === 'GET') {
    try {
      const response = await api.get(`api/feature_extractor/studies/${id}/performance/`);
      res.status(200).json(response.data);
    } catch (error) {
      console.error('Failed to fetch study performance:', error);
      const status = error.response?.status || 500;
      res.status(status).json({ message: 'Failed to fetch study performance data' });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
