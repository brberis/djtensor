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

        const response = await axios.get(`${baseUrl}/api/datasets/dataset/`);
        const data = response.data;

        res.status(200).json(data);
      } catch (error) {
        console.error('Failed to fetch training datasets:', error);
        res.status(500).json({ message: 'Failed to fetch training datasets' });
      }
      break;

    case 'POST':

      const formData = new FormData();

      // Append files and other data from the request to the FormData
      for (const key in req.body) {
          formData.append(key, req.body[key]);
      }


      try {
        const response = await axios.post(`${baseUrl}/api/datasets/dataset/`, req.body);
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
