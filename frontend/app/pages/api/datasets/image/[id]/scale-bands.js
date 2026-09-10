import { createApiClient } from '../../../../../utils/apiProxy';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  try {
    const api = createApiClient(req);
    const { data } = await api.get(`api/datasets/image/${id}/scale-bands/`);
    return res.status(200).json(data);
  } catch (err) {
    const status = err?.response?.status || 500;
    return res.status(status).json(err?.response?.data || { error: 'Failed to load scale bands' });
  }
}
