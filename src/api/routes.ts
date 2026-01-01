import { Router } from 'express';
import { uploadRouter } from './upload.js';

export const apiRoutes = Router();

apiRoutes.use(uploadRouter);
