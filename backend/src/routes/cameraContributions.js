const express = require('express');
const {
  createContribution,
  deleteContribution,
  getContributions,
  reviewContribution,
} = require('../controllers/cameraContributionController');

const router = express.Router();

router.post('/', createContribution);
router.get('/', getContributions);
router.patch('/:id', reviewContribution);
router.delete('/:id', deleteContribution);

module.exports = router;
