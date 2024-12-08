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
  const baseUrl = process.env.DJANGO_API_BASE_URL; 

  switch (req.method) {
    case 'GET':
      try {
        const response = await axios.get(`${baseUrl}/api/feature_extractor/tests/`);
        const data = response.data;
        res.status(200).json(data);
      } catch (error) {
        console.error('Failed to fetch tests:', error);
        res.status(500).json({ message: 'Failed to fetch tests' });
      }
      break;

    case 'POST':
      try {
        const postData = req.body;  
        const response = await axios.post(`${baseUrl}/api/feature_extractor/tests/`, postData);
        const data = response.data;
        res.status(201).json(data);
      } catch (error) {
        console.error('Failed to create training tests:', error);
        res.status(500).json({ message: 'Failed to create tests' });
      }
      break;

    default:
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
