import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  title: text("title").notNull(),
  activeQuestion: integer("active_question").notNull().default(0),
  ended: integer("ended").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const questions = sqliteTable("questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomCode: text("room_code").notNull(),
  type: text("type").notNull(),
  prompt: text("prompt").notNull(),
  options: text("options").notNull().default("[]"),
  position: integer("position").notNull(),
});

export const responses = sqliteTable("responses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomCode: text("room_code").notNull(),
  questionId: integer("question_id").notNull(),
  participantId: text("participant_id").notNull(),
  answer: text("answer").notNull(),
  createdAt: text("created_at").notNull(),
});
