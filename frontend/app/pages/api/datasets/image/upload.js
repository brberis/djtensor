// pages/api/datasets/image/upload.js

import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import { NextApiResponse } from 'next';

export const config = {
  api: {
    bodyParser: false,  // We need to disable the default body parser to use multer
  },
};

const upload = multer({ storage: multer.memoryStorage() });

// Utility function to handle multer setup
function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
}

export default async function handler(req, res) {
  // Handle file upload with multer
  await runMiddleware(req, res, upload.array('file'));

  const { dataset, label } = req.body;  // These fields are expected to be part of the form data

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const formData = new FormData();
  req.files.forEach(file => {
    formData.append('image', file.buffer, file.originalname);
  });
  formData.append('dataset', dataset);
  formData.append('label', label);

  try {
    const baseUrl = process.env.DJANGO_API_BASE_URL;
    const response = await axios.post(`${baseUrl}/api/datasets/image/`, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });
    res.status(201).json(response.data);
  } catch (error) {
    console.error('Failed to forward images:', error);
    res.status(500).json({ error: error.message });
  }
}
