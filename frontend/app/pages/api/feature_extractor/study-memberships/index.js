import { createApiClient } from '../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);
  const { study } = req.query;
  let url = 'api/feature_extractor/study-memberships/';
  if (study) url += `?study=${study}`;

  try {
    if (req.method === 'GET') {
      const response = await api.get(url);
      return res.status(200).json(response.data);
    }
    if (req.method === 'POST') {
      const response = await api.post('api/feature_extractor/study-memberships/', req.body);
      return res.status(response.status).json(response.data);
    }
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error) {
    return res.status(error?.response?.status || 500).json({
      message: error?.response?.data?.error || 'Request failed',
    });
  }
}
