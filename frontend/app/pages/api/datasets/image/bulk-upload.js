/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: bulk-upload.js
 * Copyright (c) 2024
 *
 * Next.js API proxy for bulk image uploads.
 * Uses multer with disk storage to avoid memory issues with large batches.
 */

import multer from 'multer';
import { createApiClient } from '../../../../utils/apiProxy';
import FormData from 'form-data';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const config = {
  api: {
    bodyParser: false,
    // Increase response size limit for large result payloads
    responseLimit: false,
  },
};

// Use disk storage instead of memory to handle large uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tmpDir = path.join(os.tmpdir(), 'djtensor-uploads');
    fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (req, file, cb) => {
    // Use a unique prefix to avoid collisions
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + '-' + file.originalname);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB max for archives
    files: 100, // max files per request (we chunk at 50 images on the client)
  },
});

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const api = createApiClient(req);

  try {
    // Accept both 'image' (multiple) and 'archive' (single) fields
    await runMiddleware(req, res, upload.fields([
      { name: 'image', maxCount: 100 },
      { name: 'archive', maxCount: 1 },
    ]));
  } catch (err) {
    console.error('Multer error:', err);
    return res.status(400).json({ error: 'File upload error: ' + err.message });
  }

  const { dataset_id, label_id, dataset, label } = req.body;
  const imageFiles = req.files?.image || [];
  const archiveFiles = req.files?.archive || [];

  // Build the form to forward to Django
  const formData = new FormData();
  formData.append('dataset_id', dataset_id || dataset);
  formData.append('label_id', label_id || label);

  const tempFilePaths = [];

  try {
    // Attach image files
    for (const file of imageFiles) {
      tempFilePaths.push(file.path);
      formData.append('image', fs.createReadStream(file.path), file.originalname);
    }

    // Attach archive file
    for (const file of archiveFiles) {
      tempFilePaths.push(file.path);
      formData.append('archive', fs.createReadStream(file.path), file.originalname);
    }

    const response = await api.post('api/datasets/image/bulk-upload/', formData, {
      headers: {
        ...formData.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 300000, // 5 minute timeout for large uploads
    });

    res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Bulk upload proxy error:', error?.response?.data || error.message);
    const status = error?.response?.status || 500;
    const data = error?.response?.data || { error: error.message };
    res.status(status).json(data);
  } finally {
    // Clean up temp files written by multer
    for (const fp of tempFilePaths) {
      try { fs.unlinkSync(fp); } catch (e) { /* ignore */ }
    }
  }
}
