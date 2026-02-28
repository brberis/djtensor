import { createApiClient } from '../../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);
  const { id } = req.query;
  const url = `api/feature_extractor/tests/${id}/stop/`;

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end();
  }

  try {
    const response = await api.post(url, {});
    return res.status(response.status).json(response.data);
  } catch (error) {
    return res.status(error?.response?.status || 500).json({
      message: error?.response?.data?.error || 'Request failed',
    });
  }
}
