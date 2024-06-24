import axios from 'axios';

export default async function handler(req, res) {
  const baseUrl = process.env.DJANGO_API_BASE_URL;

  switch (req.method) {

    case 'POST':

      const formData = new FormData();

      // Append files and other data from the request to the FormData
      for (const key in req.body) {
          formData.append(key, req.body[key]);
      }


      try {
        const response = await axios.post(`${baseUrl}/api/datasets/generate-dataset/`, req.body);
        const data = response.data;

        res.status(201).json(data);
      } catch (error) {
        console.error('Failed to create training dataset:', error);
        res.status(500).json({ message: 'Failed to create training dataset' });
      }
      break;
      default:
        res.setHeader('Allow', ['GET', 'POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}
