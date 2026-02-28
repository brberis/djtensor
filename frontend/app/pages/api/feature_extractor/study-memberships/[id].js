import { createApiClient } from '../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);
  const { id } = req.query;
  const url = `api/feature_extractor/study-memberships/${id}/`;

  try {
    if (req.method === 'PATCH') {
      const response = await api.patch(url, req.body);
      return res.status(response.status).json(response.data);
    }
    if (req.method === 'DELETE') {
      await api.delete(url);
      return res.status(204).end();
    }
    res.setHeader('Allow', ['PATCH', 'DELETE']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error) {
    return res.status(error?.response?.status || 500).json({
      message: error?.response?.data?.error || 'Request failed',
    });
  }
}
