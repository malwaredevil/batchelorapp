import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";

interface BackgroundTask {
  id: string;
  label: string;
}

interface BackgroundTaskContextValue {
  tasks: BackgroundTask[];
  addTask: (label: string) => () => void;
}

const BackgroundTaskContext = createContext<BackgroundTaskContextValue>({
  tasks: [],
  addTask: () => () => {},
});

export function BackgroundTaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const idRef = useRef(0);

  const addTask = useCallback((label: string): (() => void) => {
    const id = String(++idRef.current);
    setTasks((prev) => [...prev, { id, label }]);
    return () => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
    };
  }, []);

  return (
    <BackgroundTaskContext.Provider value={{ tasks, addTask }}>
      {children}
    </BackgroundTaskContext.Provider>
  );
}

export function useBackgroundTasks() {
  return useContext(BackgroundTaskContext);
}

export function useAddBackgroundTask() {
  return useContext(BackgroundTaskContext).addTask;
}
