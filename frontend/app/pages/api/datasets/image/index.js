/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: index.js
 * Copyright (c) 2024
 */

import { createApiClient } from '../../../../utils/apiProxy';
import FormData from 'form-data';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });

export const config = {
  api: {
    bodyParser: false, // Disables the default body parser to use multer
  },
};

export default async function handler(req, res) {
  const api = createApiClient(req);
  if (req.method === 'GET') {
    const { dataset, label, page, search } = req.query;

    try {
      const response = await api.get(`api/datasets/image/`, { params: { dataset, label, page, search } });
      res.status(200).json(response.data);
    } catch (error) {
      console.error('Failed to fetch images:', error);
      res.status(500).json({ message: 'Failed to fetch images' });
    }
  } else if (req.method === 'POST') {
    upload.any()(req, res, async (err) => {
      if (err) {
        return res.status(500).json({ message: 'File upload error', error: err.message });
      }

      const formData = new FormData();
      for (const key in req.body) {
        formData.append(key, req.body[key]);
      }

      if (req.files) {
        req.files.forEach(file => {
          formData.append('files', file.buffer, file.originalname);
        });
      }

      try {
        const response = await api({
          method: 'post',
          url: `api/datasets/image/upload`,
          data: formData,
          headers: formData.getHeaders(),
        });
        res.status(201).json(response.data);
      } catch (error) {
        console.error('Failed to upload images:', error);
        res.status(500).json({ message: 'Failed to upload images' });
      }
    });
  } else {
    res.status(405).json({ message: 'Method not allowed' });
  }
}
