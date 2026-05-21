import mongoose from "mongoose";

// LGA Schema
const lgaSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    state: {
      type: String,
      required: true,
    },
    code: {
      type: String,
      unique: true,
      sparse: true,
    },
    population: Number,
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

lgaSchema.index({ state: 1, name: 1 });

export const LGA = mongoose.model("LGA", lgaSchema);

// PHC Schema
const phcSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    phcCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    address: String,
    lga: {
      type: String,
      required: true,
      ref: "LGA",
    },
    state: {
      type: String,
      required: true,
    },
    coordinates: {
      latitude: Number,
      longitude: Number,
    },
    contactName: String,
    contactPhone: String,
    email: String,
    isActive: {
      type: Boolean,
      default: true,
    },
    servesChews: {
      type: Number,
      default: 0,
    },
    servesWomen: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

phcSchema.index({ lga: 1, state: 1 });
phcSchema.index({ coordinates: "2dsphere" }); // For geospatial queries

export const PHC = mongoose.model("PHC", phcSchema);

// Reference Data Service
class ReferenceDataService {
  /**
   * Get all LGAs
   */
  async getAllLGAs(state = null) {
    const query = { isActive: true };
    if (state) query.state = state;
    return LGA.find(query).sort({ name: 1 });
  }

  /**
   * Get all states
   */
  async getAllStates() {
    return LGA.distinct("state", { isActive: true }).sort();
  }

  /**
   * Get LGAs by state
   */
  async getLGAsByState(state) {
    return LGA.find({ state, isActive: true }).sort({ name: 1 });
  }

  /**
   * Get PHCs by LGA
   */
  async getPHCsByLGA(lga) {
    return PHC.find({ lga, isActive: true }).sort({ name: 1 });
  }

  /**
   * Get PHCs by state
   */
  async getPHCsByState(state) {
    return PHC.find({ state, isActive: true }).sort({ lga: 1, name: 1 });
  }

  /**
   * Find nearest PHC by coordinates
   */
  async getNearestPHC(latitude, longitude, maxDistance = 5000) {
    // Distance in meters
    return PHC.findOne({
      coordinates: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
          $maxDistance: maxDistance,
        },
      },
      isActive: true,
    });
  }

  /**
   * Add new LGA
   */
  async addLGA(lgaData) {
    const lga = new LGA(lgaData);
    return lga.save();
  }

  /**
   * Add new PHC
   */
  async addPHC(phcData) {
    const phc = new PHC(phcData);
    return phc.save();
  }

  /**
   * Update LGA
   */
  async updateLGA(lgaId, updates) {
    return LGA.findByIdAndUpdate(lgaId, updates, { new: true });
  }

  /**
   * Update PHC
   */
  async updatePHC(phcId, updates) {
    return PHC.findByIdAndUpdate(phcId, updates, { new: true });
  }

  /**
   * Delete LGA
   */
  async deleteLGA(lgaId) {
    return LGA.findByIdAndUpdate(
      lgaId,
      { isActive: false },
      { new: true },
    );
  }

  /**
   * Delete PHC
   */
  async deletePHC(phcId) {
    return PHC.findByIdAndUpdate(
      phcId,
      { isActive: false },
      { new: true },
    );
  }
}

export default new ReferenceDataService();
