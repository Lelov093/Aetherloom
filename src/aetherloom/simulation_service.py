"""API-owned worker process: persists beyond Workspace/window visibility."""
import asyncio
import subprocess
import sys
import os
from .simulation_repository import SimulationRepository


class SimulationService:
    def __init__(self, path):
        self.repo = SimulationRepository(path)
        self.repo.pause_all('应用已重开：从已保存状态继续需要用户操作。')
        self.worker = subprocess.Popen([sys.executable, '-m', 'aetherloom.simulation_worker', str(path.resolve()), str(os.getpid())],
                                       env=dict(os.environ),
                                       creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)

    def health(self):
        alive = self.worker.poll() is None
        if not alive:
            self.repo.pause_all('独立 Worker 已停止，模拟已暂停；请重开应用。')
        return {'alive':alive}

    async def shutdown(self):
        self.repo.pause_all('应用已明确退出，保存暂停状态。')
        if self.worker.poll() is None:
            if sys.platform == 'win32':
                await asyncio.to_thread(subprocess.run, ['taskkill','/PID',str(self.worker.pid),'/T','/F'],
                                        capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
            else:
                self.worker.terminate()
            await asyncio.to_thread(self.worker.wait, 5)
