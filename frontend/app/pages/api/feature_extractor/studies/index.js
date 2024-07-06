import axios from 'axios';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      // Use the environment variable to get the base URL
      const baseUrl = process.env.DJANGO_API_BASE_URL;

      const response = await axios.get(`${baseUrl}/api/feature_extractor/studies/`);
      const data = response.data;

      res.status(200).json(data);
    } catch (error) {
      console.error('Failed to fetch studies:', error);
      res.status(500).json({ message: 'Failed to fetch studies' });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
