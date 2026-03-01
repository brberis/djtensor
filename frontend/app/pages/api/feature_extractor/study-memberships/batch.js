import { createApiClient } from '../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);

  try {
    if (req.method === 'POST') {
      const response = await api.post('api/feature_extractor/study-memberships/batch/', req.body);
      return res.status(response.status).json(response.data);
    }
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error) {
    return res.status(error?.response?.status || 500).json({
      message: error?.response?.data?.error || 'Request failed',
    });
  }
}
