import { readyTasks } from './lib/docs.mjs';

const tasks = readyTasks(process.cwd());
for (const task of tasks) console.log(`${task.id} - ${task.title}`);
console.log('Dependency-ready only: check progress/handoff ownership before taking a task.');
