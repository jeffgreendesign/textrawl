import { Router, type Router as RouterType } from 'express';
import { uploadRouter } from './upload.js';

export const apiRoutes: RouterType = Router();

apiRoutes.use(uploadRouter);
