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
