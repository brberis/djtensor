import axios from 'axios';

export default async function handler(req, res) {
  const baseUrl = process.env.DJANGO_API_BASE_URL;  // Base URL for your Django backend

  switch (req.method) {
    case 'GET':
      try {
        const response = await axios.get(`${baseUrl}/api/feature_extractor/trainingsession/`);
        const data = response.data;
        res.status(200).json(data);
      } catch (error) {
        console.error('Failed to fetch training sessions:', error);
        res.status(500).json({ message: 'Failed to fetch training sessions' });
      }
      break;

    case 'POST':
      try {
        const postData = req.body;  // Make sure to validate and sanitize input data
        const response = await axios.post(`${baseUrl}/api/feature_extractor/trainingsession/`, postData);
        const data = response.data;
        res.status(201).json(data);
      } catch (error) {
        console.error('Failed to create training session:', error);
        res.status(500).json({ message: 'Failed to create training session' });
      }
      break;

    default:
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
