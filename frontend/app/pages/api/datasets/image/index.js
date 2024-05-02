import axios from 'axios';
import FormData from 'form-data';
import multer from 'multer';
const upload = multer();

// Setup multer for memory storage (files will be stored in memory as Buffer)

export default async function handler(req, res) {
  const baseUrl = process.env.DJANGO_API_BASE_URL; 

  if (req.method === 'GET') {
    const { dataset } = req.query;
    try {
      const response = await axios.get(`${baseUrl}/api/datasets/image/`, { params: { dataset } });
      res.status(200).json(response.data);
    } catch (error) {
      console.error('Failed to fetch images:', error);
      res.status(500).json({ message: 'Failed to fetch images' });
    }
  } else if (req.method === 'POST') {
  if (!req.body) {
    res.status(400).send('No data sent!');
    return;
  }

  const formData = new FormData();
  // Assuming req.body could already contain files as Buffers or Streams
  for (const key in req.body) {
    if (key === 'files' && Array.isArray(req.body[key])) {
      // Handling files if provided
      req.body[key].forEach(file => {
        formData.append('files', file.data, { filename: file.name });
      });
    } else {
      formData.append(key, req.body[key]);
    }
  }

  try {
    const response = await axios({
      method: 'post',
      url: `${baseUrl}/api/datasets/image/`,
      data: formData,
      headers: formData.getHeaders(),
    });
    res.status(201).json(response.data);
  } catch (error) {
    console.error('Failed to create training dataset:', error);
    res.status(500).json({ message: 'Failed to create training dataset' });
  }

}
}
