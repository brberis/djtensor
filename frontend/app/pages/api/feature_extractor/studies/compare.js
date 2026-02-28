import { createApiClient } from '../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);

  if (req.method === 'GET') {
    try {
      // Forward query params (ids=1&ids=2&ids=3)
      const queryString = req.url.split('?')[1] || '';
      const response = await api.get(`api/feature_extractor/studies/compare/?${queryString}`);
      res.status(200).json(response.data);
    } catch (error) {
      const status = error?.response?.status || 500;
      const message = error?.response?.data || { error: 'Failed to fetch comparison data' };
      res.status(status).json(message);
    }
  } else {
    res.status(405).end('Method ' + req.method + ' Not Allowed');
  }
}
