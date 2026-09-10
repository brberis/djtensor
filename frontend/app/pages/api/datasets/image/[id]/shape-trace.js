/*
 * Shark AI
 * Author: Cristobal Barberis
 *
 * Proxies the step-by-step replay of Katie's shape score. The first request
 * for an image runs her search twice (replay plus verification), which takes
 * several seconds, so this route sets a generous timeout of its own.
 */
import { createApiClient } from '../../../../../utils/apiProxy';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id, reference } = req.query;
  try {
    const api = createApiClient(req);
    const { data } = await api.get(`api/datasets/image/${id}/shape-trace/`, {
      params: reference ? { reference } : undefined,
      timeout: 60000,
    });
    return res.status(200).json(data);
  } catch (err) {
    const status = err?.response?.status || 500;
    return res.status(status).json(err?.response?.data || { error: 'The shape analysis could not be loaded.' });
  }
}
