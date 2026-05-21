import ReferenceDataService from "../services/referenceDataService.js";

class ReferenceDataController {
  /**
   * Get all LGAs
   */
  async getAllLGAs(req, res) {
    try {
      const { state } = req.query;
      const lgas = await ReferenceDataService.getAllLGAs(state);
      res.json(lgas);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get all states
   */
  async getAllStates(req, res) {
    try {
      const states = await ReferenceDataService.getAllStates();
      res.json({ states });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get LGAs by state
   */
  async getLGAsByState(req, res) {
    try {
      const { state } = req.params;
      const lgas = await ReferenceDataService.getLGAsByState(state);
      res.json(lgas);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get PHCs by LGA
   */
  async getPHCsByLGA(req, res) {
    try {
      const { lga } = req.params;
      const phcs = await ReferenceDataService.getPHCsByLGA(lga);
      res.json(phcs);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get PHCs by state
   */
  async getPHCsByState(req, res) {
    try {
      const { state } = req.params;
      const phcs = await ReferenceDataService.getPHCsByState(state);
      res.json(phcs);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Find nearest PHC by coordinates
   */
  async getNearestPHC(req, res) {
    try {
      const { latitude, longitude, maxDistance } = req.query;

      if (!latitude || !longitude) {
        return res.status(400).json({
          error: "Latitude and longitude required",
        });
      }

      const phc = await ReferenceDataService.getNearestPHC(
        Number.parseFloat(latitude),
        Number.parseFloat(longitude),
        maxDistance ? Number.parseInt(maxDistance) : 5000,
      );

      if (!phc) {
        return res
          .status(404)
          .json({ error: "No PHC found within specified distance" });
      }

      res.json(phc);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Create LGA (Admin only)
   */
  async createLGA(req, res) {
    try {
      const { name, state, code, population } = req.body;

      if (!name || !state) {
        return res.status(400).json({ error: "Name and state are required" });
      }

      const lga = await ReferenceDataService.addLGA({
        name,
        state,
        code,
        population,
      });

      res.status(201).json(lga);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Create PHC (Admin only)
   */
  async createPHC(req, res) {
    try {
      const {
        name,
        lga,
        state,
        address,
        phcCode,
        contactName,
        contactPhone,
        email,
        coordinates,
      } = req.body;

      if (!name || !lga || !state) {
        return res
          .status(400)
          .json({ error: "Name, LGA, and state are required" });
      }

      const phc = await ReferenceDataService.addPHC({
        name,
        lga,
        state,
        address,
        phcCode,
        contactName,
        contactPhone,
        email,
        coordinates,
      });

      res.status(201).json(phc);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Update LGA (Admin only)
   */
  async updateLGA(req, res) {
    try {
      const { lgaId } = req.params;
      const lga = await ReferenceDataService.updateLGA(lgaId, req.body);

      if (!lga) {
        return res.status(404).json({ error: "LGA not found" });
      }

      res.json(lga);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Update PHC (Admin only)
   */
  async updatePHC(req, res) {
    try {
      const { phcId } = req.params;
      const phc = await ReferenceDataService.updatePHC(phcId, req.body);

      if (!phc) {
        return res.status(404).json({ error: "PHC not found" });
      }

      res.json(phc);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Delete LGA (Admin only)
   */
  async deleteLGA(req, res) {
    try {
      const { lgaId } = req.params;
      const lga = await ReferenceDataService.deleteLGA(lgaId);

      if (!lga) {
        return res.status(404).json({ error: "LGA not found" });
      }

      res.json({ message: "LGA deleted successfully" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Delete PHC (Admin only)
   */
  async deletePHC(req, res) {
    try {
      const { phcId } = req.params;
      const phc = await ReferenceDataService.deletePHC(phcId);

      if (!phc) {
        return res.status(404).json({ error: "PHC not found" });
      }

      res.json({ message: "PHC deleted successfully" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default new ReferenceDataController();
