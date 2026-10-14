import React from 'react';
import ReactDOM from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { App } from './app/App';
import './styles/tokens.css';
import './styles/workspace.css';
import './styles/creation.css';
import './styles/review.css';
import './styles/objects.css';
import './styles/content-library.css';
import './styles/simulation.css';
import './styles/reading.css';
import './styles/create-panels.css';
import './styles/content-experience.css';
import './styles/form-controls.css';
import './styles/simulation-experience.css';
import './styles/review-experience.css';
import '@xyflow/react/dist/style.css';
import './styles/explore.css';
import './styles/timeline.css';

const router=createHashRouter([{path:'*',element:<App/>}]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><RouterProvider router={router}/></React.StrictMode>,
);
