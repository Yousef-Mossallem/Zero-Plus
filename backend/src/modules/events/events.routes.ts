import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { EventsService } from './events.service.js';
import { createEventSchema, getEventsQuerySchema } from './events.schema.js';

export function createEventRouter(eventsService: EventsService): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = createEventSchema.parse(req.body);
      const result = await eventsService.createEvent(validatedData);
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedQuery = getEventsQuerySchema.parse(req.query);
      const result = await eventsService.getEvents(validatedQuery as any);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}