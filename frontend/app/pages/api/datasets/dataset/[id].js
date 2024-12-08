/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: [id].js
 * Copyright (c) 2024
 */

import axios from 'axios';

export default async function handler(req, res) {
  const { id } = req.query;
  const baseUrl = process.env.DJANGO_API_BASE_URL; 

  const url = `${baseUrl}/api/datasets/dataset/${id}`;

  switch (req.method) {
    case 'GET':
      try {
        const response = await axios.get(url);
        const data = response.data;
        res.status(200).json(data);
      } catch (error) {
        console.error('Failed to fetch training dataset:', error);
        res.status(500).json({ message: 'Failed to fetch dataset' });
      }
      break;


    case 'DELETE':
      try {
        const { id } = req.query;  
        if (!id) {
          return res.status(400).json({ message: 'Missing ID for deletion' });
        }
        await axios.get(url);
        res.status(204).end();  
      } catch (error) {
        console.error('Failed to delete training dataset:', error);
        res.status(500).json({ message: 'Failed to delete training dataset' });
      }
      break;

    default:
      res.setHeader('Allow', ['GET', 'DELETE']);
      res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
