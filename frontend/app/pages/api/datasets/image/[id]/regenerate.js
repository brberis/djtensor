import { createApiClient } from '../../../../../utils/apiProxy';

export default async function handler(req, res) {
  const api = createApiClient(req);
  const { id } = req.query;

  if (req.method === 'POST') {
    try {
      const response = await api.post(`api/datasets/image/${id}/regenerate/`);
      res.status(200).json(response.data);
    } catch (error) {
      console.error('Failed to regenerate image:', error);
      const status = error?.response?.status || 500;
      const message = error?.response?.data?.error || 'Failed to regenerate image';
      res.status(status).json({ message });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
